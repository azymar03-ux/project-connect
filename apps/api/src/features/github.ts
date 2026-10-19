import { Controller, Post, Param, Req, HttpException } from "@nestjs/common";
import type { Request } from "express";
import { db, uid } from "../core/security";
import { githubRepo } from "../core/github-url";
import { githubMetadata } from "../core/github-metadata";
@Controller("api/resources")
export class GithubController {
  @Post(":id/github-metadata") async metadata(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    await uid(req);
    const resource = await db.resource.findUnique({ where: { id } });
    if (!resource?.approved)
      throw new HttpException("Resource not found.", 404);
    const { owner, repo } = githubRepo(resource.url);
    try {
      const result = await githubMetadata.get(owner, repo);
      await uid(req);
      const current = await db.resource.findUnique({
        where: { id },
        select: { approved: true, url: true },
      });
      if (!current?.approved || current.url !== resource.url)
        throw new HttpException(
          "Resource changed. Refresh and try again.",
          409,
        );
      return result;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      if (e.message === "GITHUB_RATE_LIMITED")
        throw new HttpException(
          {
            message: "GitHub quota exhausted. Retry later.",
            code: "GITHUB_RATE_LIMITED",
          },
          503,
        );
      if (e.message === "GITHUB_NOT_FOUND")
        throw new HttpException("Repository not found.", 404);
      throw new HttpException("Could not fetch public GitHub metadata.", 502);
    }
  }
}
