import { All, Controller } from '@nestjs/common';

/**
 * Sem isto, uma rota que não bate em nenhum controller responde 404 direto do Express — ANTES do
 * guard global rodar, porque não há handler casado para aplicar o guard. Isso vazaria "esta rota
 * existe ou não" sem exigir autenticação. Registrado por último (ver `app.module.ts`), este
 * controller só casa o que nenhum outro casou; como não é `@Public()`, o `AccessGuard` nega com
 * 401 antes de chegar ao corpo do método.
 */
@Controller()
export class CatchAllController {
  @All('*')
  handle(): void {
    // Nunca executa: AccessGuard já lançou 401 antes de chegar aqui.
  }
}
