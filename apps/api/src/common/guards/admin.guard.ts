import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';
import { PrismaService } from '../../database/prisma.service';

/**
 * Para o que é GLOBAL (vale para todos os usuários, ex.: tabelas de imposto): só `papel = ADMIN`. Lê o
 * papel do banco a cada chamada (o JWT só carrega o `sub`), então rebaixar um admin vale na hora.
 * Roda depois do `AccessGuard` global, que já verificou o token.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest<Request>().user?.sub;
    if (!userId) {
      throw new UnauthorizedException();
    }
    const usuario = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { papel: true },
    });
    if (usuario?.papel !== 'ADMIN') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'ACESSO_NEGADO',
        message: 'Apenas administradores podem alterar isto.',
      });
    }
    return true;
  }
}
