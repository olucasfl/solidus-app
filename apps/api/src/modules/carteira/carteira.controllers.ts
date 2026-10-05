import type {
  Caixinha,
  Carteira,
  CdiSyncResponse,
  ConferenciaCaixinha,
  ImpostosResponse,
  FaixaImposto,
  MovimentoCaixinha,
  SugestaoMovimento,
  TipoImposto,
} from '@solidus/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SYNC_THROTTLE_LIMIT, SYNC_THROTTLE_TTL_MS } from '../sync/sync.constants';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { CaixinhasService } from './caixinhas.service';
import { CarteiraService } from './carteira.service';
import { CdiService } from './cdi.service';
import {
  AtualizarCaixinhaDto,
  CarteiraQuery,
  CriarCaixinhaDto,
  CriarMovimentoDto,
  SubstituirImpostosDto,
  SugestoesQuery,
} from './dto/carteira.dto';
import { ImpostosService } from './impostos.service';

const TIPOS_IMPOSTO = { IR: 'IR', IOF: 'IOF' } as const;

// Tudo autenticado pelo guard global (nenhum @Public()), exceto POST /cdi/sincronizar mais abaixo.
@Controller('caixinhas')
export class CaixinhasController {
  constructor(
    private readonly caixinhas: CaixinhasService,
    private readonly carteira: CarteiraService,
  ) {}

  @Get()
  listar(): Promise<Caixinha[]> {
    return this.caixinhas.listar();
  }

  @Post()
  criar(@Body() dto: CriarCaixinhaDto): Promise<Caixinha> {
    return this.caixinhas.criar(dto);
  }

  @Patch(':id')
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarCaixinhaDto,
  ): Promise<Caixinha> {
    return this.caixinhas.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.caixinhas.remover(id);
  }

  @Get(':id/conferencia')
  conferir(@Param('id', ParseUUIDPipe) id: string): Promise<ConferenciaCaixinha> {
    return this.carteira.conferir(id);
  }

  @Get(':id/movimentos')
  listarMovimentos(@Param('id', ParseUUIDPipe) id: string): Promise<MovimentoCaixinha[]> {
    return this.caixinhas.listarMovimentos(id);
  }

  @Post(':id/movimentos')
  criarMovimento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CriarMovimentoDto,
  ): Promise<MovimentoCaixinha> {
    return this.caixinhas.criarMovimento(id, dto);
  }
}

@Controller('movimentos')
export class MovimentosController {
  constructor(private readonly caixinhas: CaixinhasService) {}

  @Get('sugestoes')
  sugestoes(@Query() query: SugestoesQuery): Promise<SugestaoMovimento[]> {
    return this.caixinhas.sugestoes(query.desde);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remover(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.caixinhas.removerMovimento(id);
  }
}

@Controller('impostos')
export class ImpostosController {
  constructor(private readonly impostos: ImpostosService) {}

  @Get()
  listar(): Promise<ImpostosResponse> {
    return this.impostos.listar();
  }

  @Put(':tipo')
  substituir(
    @Param('tipo', new ParseEnumPipe(TIPOS_IMPOSTO)) tipo: TipoImposto,
    @Body() dto: SubstituirImpostosDto,
  ): Promise<FaixaImposto[]> {
    return this.impostos.substituir(tipo, dto.faixas);
  }
}

@Controller('carteira')
export class CarteiraController {
  constructor(private readonly carteira: CarteiraService) {}

  @Get()
  consultar(@Query() query: CarteiraQuery): Promise<Carteira> {
    return this.carteira.consultar(query.data);
  }
}

@Controller('cdi')
export class CdiController {
  constructor(private readonly cdi: CdiService) {}

  // @Public() só para o AccessGuard de usuário: a chamada vem do cron externo, sem sessão (ADR 0005,
  // RULES §3). A rota NÃO é aberta — o SyncTokenGuard exige o SYNC_CRON_TOKEN.
  @Public()
  @UseGuards(SyncTokenGuard)
  @Throttle({ default: { limit: SYNC_THROTTLE_LIMIT, ttl: SYNC_THROTTLE_TTL_MS } })
  @Post('sincronizar')
  @HttpCode(HttpStatus.OK)
  sincronizar(): Promise<CdiSyncResponse> {
    return this.cdi.sincronizar();
  }
}
