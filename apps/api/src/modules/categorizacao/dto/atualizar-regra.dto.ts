import { CATEGORIA_IDS, type CategoriaId } from '@solidus/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

/**
 * Edição parcial de uma regra (`PATCH /regras/:id`). Campos ausentes não mudam; `null` em `tipo` e
 * nos limites da faixa REMOVE a restrição. É assim que o usuário ajusta uma regra quando a vida muda
 * (ex.: o salário subiu e a faixa precisa acompanhar) sem apagar e recriar nem mexer em código.
 */
export class AtualizarRegraDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  padrao?: string;

  @IsOptional()
  @IsIn(CATEGORIA_IDS)
  categoria?: CategoriaId;

  @IsOptional()
  @ValidateIf((o: AtualizarRegraDto) => o.tipo !== null)
  @IsIn(['DEBITO', 'CREDITO'])
  tipo?: 'DEBITO' | 'CREDITO' | null;

  @IsOptional()
  @ValidateIf((o: AtualizarRegraDto) => o.valorMinCentavos !== null)
  @IsInt()
  @Min(0)
  valorMinCentavos?: number | null;

  @IsOptional()
  @ValidateIf((o: AtualizarRegraDto) => o.valorMaxCentavos !== null)
  @IsInt()
  @Min(0)
  valorMaxCentavos?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  prioridade?: number;
}
