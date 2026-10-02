import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Modulo global: o PrismaService fica disponivel para injecao em qualquer
 * modulo sem precisar reimporta-lo.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
