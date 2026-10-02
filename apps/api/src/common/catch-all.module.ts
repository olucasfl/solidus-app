import { Module } from '@nestjs/common';
import { CatchAllController } from './catch-all.controller';

/**
 * Importado por último em `app.module.ts`, de propósito: módulos são registrados na ordem dos
 * `imports`, e o `CatchAllController` (`*`) só pode casar o que nenhum controller anterior casou.
 */
@Module({
  controllers: [CatchAllController],
})
export class CatchAllModule {}
