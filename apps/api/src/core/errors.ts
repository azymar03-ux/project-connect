import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    let status = 500,
      message = "An unexpected error occurred.",
      code = "INTERNAL_ERROR";
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      message =
        typeof body === "string"
          ? body
          : (body as { message: string }).message || error.message;
      code =
        typeof body === "object" && typeof (body as any).code === "string"
          ? (body as any).code
          : "REQUEST_ERROR";
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        status = 404;
        message = "Record not found.";
        code = "NOT_FOUND";
      } else if (error.code === "P2002") {
        status = 409;
        message = "This record already exists.";
        code = "CONFLICT";
      } else if (error.code === "P2003") {
        status = 400;
        message = "Invalid related record.";
        code = "INVALID_REFERENCE";
      } else if (
        error.code === "P2034" ||
        (error.code === "P2010" &&
          ["40P01", "40001"].includes(String(error.meta?.code)))
      ) {
        status = 409;
        message = "Concurrent update. Please retry.";
        code = "CONCURRENT_UPDATE";
      }
    }
    if (status === 500)
      console.error(
        JSON.stringify({
          level: "error",
          code,
          errorType: error instanceof Error ? error.name : "unknown",
          requestId: response.getHeader("X-Request-Id"),
        }),
      );
    response
      .status(status)
      .json({ message, code, requestId: response.getHeader("X-Request-Id") });
  }
}
