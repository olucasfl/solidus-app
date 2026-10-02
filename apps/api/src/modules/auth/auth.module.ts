import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  // Sem secret default — ver app.module.ts (dois segredos, um JwtService por módulo que precisar).
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
