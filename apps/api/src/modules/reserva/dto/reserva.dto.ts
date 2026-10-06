import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';

const BASES = ['BRUTA', 'LIQUIDA'] as const;

/**
 * Edição parcial da configuração da reserva. Cada campo só é validado se ENVIADO (`undefined` = "não mexe");
 * `@IsOptional()` não serve aqui porque trata `null` como ausente, e `null` tem que dar 400, não chegar ao banco.
 */
export class AtualizarConfiguracaoReservaDto {
  // Quantos meses de gasto a reserva deve cobrir. Teto de 60 só para barrar digitação absurda.
  @ValidateIf((o: AtualizarConfiguracaoReservaDto) => o.meses !== undefined)
  @IsInt()
  @Min(1)
  @Max(60)
  meses?: number;

  @ValidateIf((o: AtualizarConfiguracaoReservaDto) => o.base !== undefined)
  @IsIn(BASES)
  base?: (typeof BASES)[number];

  // Quantos meses FECHADOS entram na média.
  @ValidateIf((o: AtualizarConfiguracaoReservaDto) => o.janelaMeses !== undefined)
  @IsInt()
  @Min(1)
  @Max(24)
  janelaMeses?: number;
}
