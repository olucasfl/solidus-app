import { IsIn, IsOptional } from 'class-validator';

/**
 * `POST /sync?completo=true` ignora a janela recente e reprocessa TODO o histórico (backfill da
 * contraparte, spec 07). Query string chega como texto, por isso `'true' | 'false'`.
 */
export class SincronizarQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  completo?: 'true' | 'false';
}
