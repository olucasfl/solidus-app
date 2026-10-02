/**
 * Quantia em dinheiro, sempre em centavos e sempre inteiro — nunca float (RULES.md). A validação
 * de "é mesmo inteiro" vive em `apps/api/src/domain/money/centavos.ts` (lado que grava e calcula);
 * este tipo é só o contrato de transporte entre API e web.
 */
export type Centavos = number;
