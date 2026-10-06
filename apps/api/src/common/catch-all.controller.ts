import { All, Controller, NotFoundException } from '@nestjs/common';

/**
 * Sem isto, uma rota que não bate em nenhum controller responde 404 direto do Express — ANTES do
 * guard global rodar, porque não há handler casado para aplicar o guard. Isso vazaria "esta rota
 * existe ou não" sem exigir autenticação. Registrado por último (ver `app.module.ts`), este
 * controller só casa o que nenhum outro casou; como não é `@Public()`, o `AccessGuard` nega com
 * 401 quem NÃO tem login válido.
 *
 * Quem TEM login válido passa pelo guard e chega ao corpo do método, então ele precisa responder
 * 404 de verdade. (Antes o corpo era vazio e a rota inexistente respondia 200, escondendo erro de
 * rota de quem consome a API.)
 */
@Controller()
export class CatchAllController {
  @All('*')
  handle(): never {
    throw new NotFoundException({
      statusCode: 404,
      code: 'ROTA_NAO_ENCONTRADA',
      message: 'Rota não encontrada.',
    });
  }
}
