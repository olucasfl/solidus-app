import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DATA_MSG = 'deve ser uma data YYYY-MM-DD';
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// O ValidationPipe global converte tipos de forma implícita: sem isto, "false" (texto) vira `true`.
// Devolve o valor cru para o `@IsBoolean()` só aceitar `true`/`false` de verdade.
const booleanoCru = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown =>
  obj[key];

export class CriarCaixinhaDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  nome!: string;

  // 11500 = 115% do CDI; 0 = não rende. Teto de 1000% só para barrar digitação absurda.
  @IsInt()
  @Min(0)
  @Max(100_000)
  percentualCdiBp!: number;

  @IsOptional()
  @Transform(booleanoCru)
  @IsBoolean()
  reservaDeGastos?: boolean;
}

export class AtualizarCaixinhaDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  nome?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  percentualCdiBp?: number;

  @IsOptional()
  @Transform(booleanoCru)
  @IsBoolean()
  reservaDeGastos?: boolean;

  @IsOptional()
  @Transform(booleanoCru)
  @IsBoolean()
  ativa?: boolean;
}

export class CriarMovimentoDto {
  @IsIn(['SALDO', 'APORTE', 'RESGATE'])
  tipo!: 'SALDO' | 'APORTE' | 'RESGATE';

  @Matches(DATA, { message: `data ${DATA_MSG}` })
  data!: string;

  // Pode faltar só quando há `transacaoId` (o serviço assume o módulo da transação).
  @IsOptional()
  @IsInt()
  @Min(0)
  valorCentavos?: number;

  @IsOptional()
  @Matches(DATA, { message: `dataOrigem ${DATA_MSG}` })
  dataOrigem?: string;

  @IsOptional()
  @IsUUID()
  transacaoId?: string;
}

export class SugestoesQuery {
  @Matches(DATA, { message: `desde ${DATA_MSG}` })
  desde!: string;
}

export class CarteiraQuery {
  @IsOptional()
  @Matches(DATA, { message: `data ${DATA_MSG}` })
  data?: string;
}

export class FaixaImpostoDto {
  // null = sem limite. A ordem e a unicidade são conferidas pelo domínio (`validarFaixas`).
  @ValidateIf((o: FaixaImpostoDto) => o.ateDias !== null)
  @IsInt()
  ateDias!: number | null;

  @IsInt()
  aliquotaBp!: number;
}

export class SubstituirImpostosDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FaixaImpostoDto)
  faixas!: FaixaImpostoDto[];
}
