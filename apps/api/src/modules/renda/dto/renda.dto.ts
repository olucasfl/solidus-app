import { Transform } from 'class-transformer';
import { IsBoolean, IsUUID } from 'class-validator';

// O ValidationPipe global converte tipos de forma implícita: sem isto, "false" (texto) vira `true`.
// Devolve o valor cru para o `@IsBoolean()` só aceitar `true`/`false` de verdade (mesmo padrão da
// carteira).
const booleanoCru = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown =>
  obj[key];

/** Aponta uma transação (do usuário da sessão) como a origem de uma fonte de salário. */
export class TransacaoFonteDto {
  @IsUUID()
  transacaoId!: string;
}

export class AtivarFonteDto {
  @Transform(booleanoCru)
  @IsBoolean()
  ativa!: boolean;
}
