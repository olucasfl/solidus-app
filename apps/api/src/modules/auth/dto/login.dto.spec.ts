import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

async function erros(payload: Record<string, unknown>) {
  const dto = plainToInstance(LoginDto, payload);
  return validate(dto);
}

describe('LoginDto', () => {
  it('aceita email, senha e cliente válidos', async () => {
    expect(
      await erros({ email: 'ana@exemplo.com', senha: 'senha-forte', cliente: 'pwa' }),
    ).toHaveLength(0);
  });

  it('aceita sem o campo cliente (opcional)', async () => {
    expect(await erros({ email: 'ana@exemplo.com', senha: 'senha-forte' })).toHaveLength(0);
  });

  it('CA-05 — rejeita email em formato inválido', async () => {
    const problemas = await erros({ email: 'nao-e-email', senha: 'senha-forte' });
    expect(problemas.some((p) => p.property === 'email')).toBe(true);
  });

  it('CA-05 — rejeita senha vazia', async () => {
    const problemas = await erros({ email: 'ana@exemplo.com', senha: '' });
    expect(problemas.some((p) => p.property === 'senha')).toBe(true);
  });

  it('rejeita cliente fora de "web"/"pwa"', async () => {
    const problemas = await erros({
      email: 'ana@exemplo.com',
      senha: 'senha-forte',
      cliente: 'desktop',
    });
    expect(problemas.some((p) => p.property === 'cliente')).toBe(true);
  });
});
