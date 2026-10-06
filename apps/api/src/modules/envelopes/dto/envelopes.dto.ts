import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

/** Cabe numa coluna `Int` (32 bits) com folga: 2 bilhões de centavos = R$ 20 milhões. */
const LIMITE_CENTAVOS = 2_000_000_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `null` só vale em `metaCentavos` (significa "sem meta"). Nos demais campos de PATCH usamos `@ValidateIf` em vez
 * de `@IsOptional()`, que trataria `null` como ausente e o deixaria chegar ao Prisma (500 em vez de 400).
 */
export class CriarEnvelopeDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  nome!: string;

  @ValidateIf((o: CriarEnvelopeDto) => o.alocadoCentavos !== undefined)
  @IsInt()
  @Min(0)
  @Max(LIMITE_CENTAVOS)
  alocadoCentavos?: number;

  // null ou ausente = sem meta
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LIMITE_CENTAVOS)
  metaCentavos?: number | null;
}

export class AtualizarEnvelopeDto {
  @ValidateIf((o: AtualizarEnvelopeDto) => o.nome !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  nome?: string;

  @ValidateIf((o: AtualizarEnvelopeDto) => o.alocadoCentavos !== undefined)
  @IsInt()
  @Min(0)
  @Max(LIMITE_CENTAVOS)
  alocadoCentavos?: number;

  // null REMOVE a meta; ausente não muda
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LIMITE_CENTAVOS)
  metaCentavos?: number | null;
}
