import type { LoginResponse, RefreshResponse, Usuario } from '@solidus/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { type Request, type Response } from 'express';
import { type AccessTokenPayload } from '../../common/guards/access.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Environment, type EnvironmentVariables } from '../../config/env.validation';
import {
  LOGIN_THROTTLE_LIMIT,
  LOGIN_THROTTLE_TTL_MS,
  REFRESH_COOKIE_MAX_AGE_PWA_MS,
  REFRESH_TOKEN_COOKIE_NAME,
} from './auth.constants';
import { SessaoInvalidaError } from './auth-errors';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Public()
  @Throttle({ default: { limit: LOGIN_THROTTLE_LIMIT, ttl: LOGIN_THROTTLE_TTL_MS } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const resultado = await this.authService.login(dto.email, dto.senha, dto.cliente ?? 'web');
    this.setRefreshCookie(res, resultado.refreshTokenBruto, resultado.refreshExpiraEm);

    return { accessToken: resultado.accessToken, usuario: resultado.usuario };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const refreshTokenBruto = this.lerCookieDeRefresh(req);
    const resultado = await this.authService.refresh(refreshTokenBruto);
    this.setRefreshCookie(res, resultado.refreshTokenBruto, resultado.refreshExpiraEm);

    return { accessToken: resultado.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshTokenBruto = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;

    if (refreshTokenBruto) {
      await this.authService.logout(refreshTokenBruto);
    }

    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: AccessTokenPayload): Promise<Usuario> {
    return this.authService.me(user.sub);
  }

  private lerCookieDeRefresh(req: Request): string {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;

    if (!token) {
      throw new SessaoInvalidaError();
    }

    return token;
  }

  private setRefreshCookie(res: Response, tokenBruto: string, expiraEm: Date | null): void {
    const production =
      this.configService.get('NODE_ENV', { infer: true }) === Environment.Production;

    res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokenBruto, {
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
      path: '/',
      // web: expira junto com a RefreshSession. pwa: a sessão não tem TTL no banco, mas o cookie
      // em si precisa de uma validade pra sobreviver a reaberturas do app (ver auth.constants.ts).
      ...(expiraEm ? { expires: expiraEm } : { maxAge: REFRESH_COOKIE_MAX_AGE_PWA_MS }),
    });
  }
}
