import { Module } from '@nestjs/common';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { CaixinhasService } from './caixinhas.service';
import {
  CaixinhasController,
  CarteiraController,
  CdiController,
  ImpostosController,
  MovimentosController,
} from './carteira.controllers';
import { CarteiraService } from './carteira.service';
import { BcbCdiGateway, CdiGateway } from './cdi.gateway';
import { CdiService } from './cdi.service';
import { ImpostosService } from './impostos.service';

@Module({
  controllers: [
    CaixinhasController,
    MovimentosController,
    ImpostosController,
    CarteiraController,
    CdiController,
  ],
  providers: [
    CaixinhasService,
    CarteiraService,
    CdiService,
    ImpostosService,
    SyncTokenGuard,
    { provide: CdiGateway, useClass: BcbCdiGateway },
  ],
})
export class CarteiraModule {}
