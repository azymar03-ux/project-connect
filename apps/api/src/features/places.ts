import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  HttpException,
} from "@nestjs/common";
import type { Request } from "express";
import { uid, validate } from "../core/security";
import { SharedLimiter } from "../core/rate-limit";
import { placesInput, searchPlaces } from "../core/places";
let limiter: Promise<SharedLimiter> | undefined;
async function budget() {
  return (limiter ??= (async () => {
    const l = new SharedLimiter(process.env.REDIS_URL);
    await l.connect();
    return l;
  })());
}
@Controller("api/places")
export class PlacesController {
  @Get("status") status() {
    return {
      configured: Boolean(
        process.env.GOOGLE_PLACES_API_KEY &&
        process.env.GOOGLE_PLACES_ENABLED === "true",
      ),
      mapConfigured: Boolean(process.env.GOOGLE_MAPS_BROWSER_KEY),
      browserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || null,
      policy:
        "Results are transient, Google attributed, never persisted as community listings. Provider search requires explicit action.",
      contactDetails: process.env.GOOGLE_PLACES_CONTACT_DETAILS === "true",
      termsAccepted: process.env.GOOGLE_PLACES_ENABLED === "true",
    };
  }
  @Post("search") async search(@Req() req: Request, @Body() b: unknown) {
    const actor = await uid(req),
      v = validate(placesInput, b);
    if (
      !process.env.GOOGLE_PLACES_API_KEY ||
      process.env.GOOGLE_PLACES_ENABLED !== "true"
    )
      throw new HttpException(
        "Google Places is not configured or owner policy approval is pending.",
        503,
      );
    try {
      const l = await budget();
      if (
        !(await l.hit("places-user:" + actor, 20, 86400000)).allowed ||
        !(
          await l.hit(
            "places-global",
            Number(process.env.GOOGLE_PLACES_DAILY_LIMIT || 200),
            86400000,
          )
        ).allowed
      )
        throw new HttpException("Places daily budget reached.", 429);
      const result = await searchPlaces(v);
      await uid(req);
      return result;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        "Google Places is unavailable. Try community listings instead.",
        502,
      );
    }
  }
}
