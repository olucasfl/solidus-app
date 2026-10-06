import type { ConexaoResponse } from '@solidus/shared';
import { Controller, Get } from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { ConexaoService } from './conexao.service';

// Autenticada pelo guard global (nenhum @Public()) e SOMENTE leitura: o retrato só muda pelo sync.
@Controller('conexao')
export class ConexaoController {
  constructor(private readonly conexao: ConexaoService) {}

  @Get()
  obter(@UserId() userId: string): Promise<ConexaoResponse> {
    return this.conexao.obter(userId);
  }
}
