import type { ClienteSessao, LoginResponse, RefreshResponse, Usuario } from '@solidus/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClienteSessao as ClienteSessaoDb } from '@prisma/client';
import * as argon2 from 'argon2';
import { type EnvironmentVariables } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_WEB_MS } from './auth.constants';
import { CredenciaisInvalidasError, SessaoInvalidaError } from './auth-errors';
import { gerarRefreshTokenBruto, hashRefreshToken } from './tokens';

/** Resultado interno de uma sessão nova — o controller decide o que fazer com `refreshTokenBruto`
 * (vai só pro cookie, nunca pro corpo da resposta nem pro `packages/shared`). */
interface SessaoCriada {
  accessToken: string;
  refreshTokenBruto: string;
  refreshExpiraEm: Date | null;
}

function paraClienteDb(cliente: ClienteSessao): ClienteSessaoDb {
  return cliente === 'pwa' ? ClienteSessaoDb.PWA : ClienteSessaoDb.WEB;
}

function paraClienteContrato(cliente: ClienteSessaoDb): ClienteSessao {
  return cliente === ClienteSessaoDb.PWA ? 'pwa' : 'web';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async login(
    email: string,
    senha: string,
    cliente: ClienteSessao,
  ): Promise<LoginResponse & Pick<SessaoCriada, 'refreshTokenBruto' | 'refreshExpiraEm'>> {
    const usuario = await this.prisma.user.findUnique({ where: { email } });

    if (!usuario || !(await argon2.verify(usuario.senhaHash, senha))) {
      throw new CredenciaisInvalidasError();
    }

    const sessao = await this.criarSessao(usuario.id, cliente);

    return {
      accessToken: sessao.accessToken,
      usuario: { id: usuario.id, email: usuario.email },
      refreshTokenBruto: sessao.refreshTokenBruto,
      refreshExpiraEm: sessao.refreshExpiraEm,
    };
  }

  async refresh(
    refreshTokenBruto: string,
  ): Promise<RefreshResponse & Pick<SessaoCriada, 'refreshTokenBruto' | 'refreshExpiraEm'>> {
    const tokenHash = hashRefreshToken(refreshTokenBruto);
    const sessaoAtual = await this.prisma.refreshSession.findFirst({ where: { tokenHash } });

    const vencida = sessaoAtual?.expiraEm != null && sessaoAtual.expiraEm.getTime() < Date.now();
    if (!sessaoAtual || sessaoAtual.revogadoEm || vencida) {
      throw new SessaoInvalidaError();
    }

    // Rotação: a sessão atual nunca volta a ser válida, mesmo se o reuso tentar de novo.
    await this.prisma.refreshSession.update({
      where: { id: sessaoAtual.id },
      data: { revogadoEm: new Date() },
    });

    const sessao = await this.criarSessao(
      sessaoAtual.userId,
      paraClienteContrato(sessaoAtual.cliente),
    );

    return {
      accessToken: sessao.accessToken,
      refreshTokenBruto: sessao.refreshTokenBruto,
      refreshExpiraEm: sessao.refreshExpiraEm,
    };
  }

  async logout(refreshTokenBruto: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshTokenBruto);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }

  async me(userId: string): Promise<Usuario> {
    const usuario = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: usuario.id, email: usuario.email };
  }

  private async criarSessao(userId: string, cliente: ClienteSessao): Promise<SessaoCriada> {
    const refreshTokenBruto = gerarRefreshTokenBruto();
    const refreshExpiraEm =
      cliente === 'pwa' ? null : new Date(Date.now() + REFRESH_TOKEN_TTL_WEB_MS);

    await this.prisma.refreshSession.create({
      data: {
        userId,
        cliente: paraClienteDb(cliente),
        tokenHash: hashRefreshToken(refreshTokenBruto),
        expiraEm: refreshExpiraEm,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );

    return { accessToken, refreshTokenBruto, refreshExpiraEm };
  }
}
