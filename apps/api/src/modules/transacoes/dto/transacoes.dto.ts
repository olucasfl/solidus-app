import { CATEGORIA_IDS, type CategoriaId } from '@solidus/shared';
import { IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator';

export class DefinirCategoriaDto {
  // `null` solta a categoria manual (volta para as regras); qualquer outro valor precisa ser da taxonomia.
  @ValidateIf((o: DefinirCategoriaDto) => o.categoria !== null)
  @IsIn(CATEGORIA_IDS)
  categoria!: CategoriaId | null;
}

export class ListarTransacoesQuery {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'mes deve ser YYYY-MM' })
  mes?: string;

  @IsOptional()
  @IsIn(CATEGORIA_IDS)
  categoria?: CategoriaId;

  @IsOptional()
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limite?: number;
}
