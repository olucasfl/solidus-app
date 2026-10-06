import { Module } from '@nestjs/common';
import { PluggyGateway, PluggySdkGateway } from './pluggy.gateway';

/**
 * A porta única para o Pluggy (só leitura) num módulo próprio, para o sync e o aviso de conexão
 * compartilharem a MESMA instância sem dependência circular entre os dois.
 */
@Module({
  providers: [{ provide: PluggyGateway, useClass: PluggySdkGateway }],
  exports: [PluggyGateway],
})
export class PluggyModule {}
