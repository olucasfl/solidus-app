import { CATEGORIA_IDS, type CategoriaId } from '@solidus/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CriarRegraDto {
  // Texto literal, nunca regex (spec 03): o trim evita regra "   " que casaria nada de útil.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  padrao!: string;

  @IsIn(CATEGORIA_IDS)
  categoria!: CategoriaId;

  @IsOptional()
  @IsIn(['DEBITO', 'CREDITO'])
  tipo?: 'DEBITO' | 'CREDITO';

  @IsOptional()
  @IsInt()
  @Min(0)
  valorMinCentavos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  valorMaxCentavos?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  prioridade?: number;
}
