import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { type HealthCheckResponse, HealthService } from './health.service';

// Aberto de propósito: monitoramento (e o cron externo, antes de chamar /sync) não tem sessão.
// Não expõe versão nem detalhe interno — só se a API está respondendo e o banco está acessível.
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  check(): Promise<HealthCheckResponse> {
    return this.healthService.check();
  }
}
