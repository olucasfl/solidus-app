import type { Envelope, EnvelopesResponse } from '@solidus/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserId } from '../../common/decorators/user-id.decorator';
import { AtualizarEnvelopeDto, CriarEnvelopeDto } from './dto/envelopes.dto';
import { EnvelopesService } from './envelopes.service';

// Tudo autenticado pelo guard global (nenhum @Public()); o dono é sempre o usuário da sessão.
@Controller('envelopes')
export class EnvelopesController {
  constructor(private readonly envelopes: EnvelopesService) {}

  @Get()
  obter(@UserId() userId: string): Promise<EnvelopesResponse> {
    return this.envelopes.obter(userId);
  }

  @Post()
  criar(@UserId() userId: string, @Body() dto: CriarEnvelopeDto): Promise<Envelope> {
    return this.envelopes.criar(userId, dto);
  }

  @Patch(':id')
  atualizar(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarEnvelopeDto,
  ): Promise<Envelope> {
    return this.envelopes.atualizar(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remover(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.envelopes.remover(userId, id);
  }
}
