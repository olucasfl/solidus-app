import { CATEGORIA_IDS, type CategoriaId } from '@solidus/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

/**
 * Edição parcial de uma regra (`PATCH /regras/:id`). Campos ausentes não mudam; `null` em `tipo` e
 * nos limites da faixa REMOVE a restrição. É assim que o usuário ajusta uma regra quando a vida muda
 * (ex.: o salário subiu e a faixa precisa acompanhar) sem apagar e recriar nem mexer em código.
 */
// padrao, categoria e prioridade: só são validados se ENVIADOS (`undefined` = "não mexe"). `@IsOptional()` trataria `null` como
// ausente e o `null` chegaria ao Prisma, que o recusa numa coluna obrigatória (500). Em `tipo` e nos limites da faixa o null é PROPOSITAL (remove a restrição).
export class AtualizarRegraDto {
  @ValidateIf((o: AtualizarRegraDto) => o.padrao !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  padrao?: string;

  @ValidateIf((o: AtualizarRegraDto) => o.categoria !== undefined)
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

  @ValidateIf((o: AtualizarRegraDto) => o.prioridade !== undefined)
  @IsInt()
  @Min(0)
  @Max(1000)
  prioridade?: number;
}
