import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  database: 'up' | 'down';
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthCheckResponse> {
    const databaseUp = await this.prisma.isHealthy();

    return {
      status: databaseUp ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      database: databaseUp ? 'up' : 'down',
    };
  }
}
