import type { ClienteSessao } from '@solidus/shared';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  // Sem regra de complexidade (RULES.md não exige — usuário único, senha escolhida fora da API).
  @IsString()
  @IsNotEmpty()
  senha!: string;

  // Ausente = 'web' (AuthController decide o default, não o DTO — mantém o campo opcional aqui).
  @IsOptional()
  @IsIn(['web', 'pwa'])
  cliente?: ClienteSessao;
}
