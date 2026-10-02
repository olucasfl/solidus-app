import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClienteSessao } from '@prisma/client';
import * as argon2 from 'argon2';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { REFRESH_TOKEN_TTL_WEB_MS } from './auth.constants';
import { CredenciaisInvalidasError, SessaoInvalidaError } from './auth-errors';
import { AuthService } from './auth.service';
import { hashRefreshToken } from './tokens';

describe('AuthService', () => {
  const SENHA_CERTA = 'senha-forte-123';
  let senhaHash: string;
  let prisma: {
    user: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    refreshSession: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let service: AuthService;

  beforeAll(async () => {
    senhaHash = await argon2.hash(SENHA_CERTA);
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      refreshSession: {
        create: jest.fn().mockResolvedValue(undefined),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const jwtService = { signAsync: jest.fn().mockResolvedValue('access-token-assinado') };
    const configService = { get: jest.fn().mockReturnValue('segredo-de-teste-com-32-caracteres') };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  describe('login', () => {
    it('CA-01 — credenciais certas: cria RefreshSession web (7 dias) e devolve accessToken + usuario', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'ana@exemplo.com',
        senhaHash,
      });

      const antes = Date.now();
      const resultado = await service.login('ana@exemplo.com', SENHA_CERTA, 'web');

      expect(resultado.accessToken).toBe('access-token-assinado');
      expect(resultado.usuario).toEqual({ id: 'user-1', email: 'ana@exemplo.com' });
      expect(prisma.refreshSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            cliente: ClienteSessao.WEB,
            tokenHash: hashRefreshToken(resultado.refreshTokenBruto),
          }),
        }),
      );
      const expiraEm = resultado.refreshExpiraEm?.getTime() ?? 0;
      expect(expiraEm).toBeGreaterThanOrEqual(antes + REFRESH_TOKEN_TTL_WEB_MS - 1000);
      expect(expiraEm).toBeLessThanOrEqual(antes + REFRESH_TOKEN_TTL_WEB_MS + 5000);
    });

    it('CA-02 — cliente "pwa": RefreshSession sem expiraEm (null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'ana@exemplo.com',
        senhaHash,
      });

      const resultado = await service.login('ana@exemplo.com', SENHA_CERTA, 'pwa');

      expect(resultado.refreshExpiraEm).toBeNull();
      expect(prisma.refreshSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cliente: ClienteSessao.PWA, expiraEm: null }),
        }),
      );
    });

    it('CA-03 — senha errada: CredenciaisInvalidasError, nenhuma sessão criada', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'ana@exemplo.com',
        senhaHash,
      });

      await expect(service.login('ana@exemplo.com', 'senha-errada', 'web')).rejects.toThrow(
        CredenciaisInvalidasError,
      );
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
    });

    it('CA-04 — e-mail inexistente: o MESMO erro de senha errada', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('naoexiste@exemplo.com', 'qualquer-coisa', 'web')).rejects.toThrow(
        CredenciaisInvalidasError,
      );
    });
  });

  describe('refresh', () => {
    function sessaoBase(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'sessao-1',
        userId: 'user-1',
        cliente: ClienteSessao.WEB,
        tokenHash: 'hash-qualquer',
        expiraEm: new Date(Date.now() + 1000 * 60 * 60),
        revogadoEm: null,
        ...overrides,
      };
    }

    it('CA-06 — rotaciona: revoga a sessão atual e cria uma nova com o mesmo cliente', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(sessaoBase());

      const resultado = await service.refresh('token-bruto-qualquer');

      expect(prisma.refreshSession.update).toHaveBeenCalledWith({
        where: { id: 'sessao-1' },
        data: { revogadoEm: expect.any(Date) },
      });
      expect(prisma.refreshSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', cliente: ClienteSessao.WEB }),
        }),
      );
      expect(resultado.accessToken).toBe('access-token-assinado');
    });

    it('CA-07/08 — sessão inexistente ou já revogada (reuso): SessaoInvalidaError', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(null);
      await expect(service.refresh('token-sem-sessao')).rejects.toThrow(SessaoInvalidaError);

      prisma.refreshSession.findFirst.mockResolvedValue(sessaoBase({ revogadoEm: new Date() }));
      await expect(service.refresh('token-revogado')).rejects.toThrow(SessaoInvalidaError);
    });

    it('CA-09 — sessão web vencida: SessaoInvalidaError', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(
        sessaoBase({ expiraEm: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('token-vencido')).rejects.toThrow(SessaoInvalidaError);
    });

    it('CA-10 — sessão pwa (expiraEm null) nunca vence por tempo', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(
        sessaoBase({ cliente: ClienteSessao.PWA, expiraEm: null }),
      );

      const resultado = await service.refresh('token-pwa-antigo');

      expect(resultado.accessToken).toBe('access-token-assinado');
      expect(resultado.refreshExpiraEm).toBeNull();
    });
  });

  describe('logout', () => {
    it('CA-14 — revoga só a sessão não revogada daquele hash', async () => {
      await service.logout('token-bruto');

      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hashRefreshToken('token-bruto'), revogadoEm: null },
        data: { revogadoEm: expect.any(Date) },
      });
    });
  });

  describe('me', () => {
    it('CA-12 — devolve id e email do usuário', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', email: 'ana@exemplo.com' });

      await expect(service.me('user-1')).resolves.toEqual({
        id: 'user-1',
        email: 'ana@exemplo.com',
      });
    });
  });
});
