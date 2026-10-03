import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export class PoupancaQuery {
  @Matches(MES, { message: 'mes deve ser YYYY-MM' })
  mes!: string;
}

export class HistoricoQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  meses?: number;
}
