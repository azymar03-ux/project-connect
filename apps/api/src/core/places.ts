import { z } from "zod";
import { boundedJson } from "./http-json";
import { distanceKm } from "./geo";
export const placesInput = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusKm: z.number().min(1).max(50).default(10),
    query: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .default("electronics hardware robotics components store"),
  })
  .strict();
const place = z.object({
  id: z.string().max(255),
  displayName: z.object({ text: z.string().max(500) }),
  formattedAddress: z.string().max(1000).optional(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  googleMapsUri: z.url().optional(),
  businessStatus: z.string().max(80).optional(),
  nationalPhoneNumber: z.string().max(80).optional(),
  internationalPhoneNumber: z.string().max(80).optional(),
  websiteUri: z.url().max(2000).optional(),
  currentOpeningHours: z
    .object({
      openNow: z.boolean().optional(),
      weekdayDescriptions: z.array(z.string().max(250)).max(7).optional(),
    })
    .optional(),
  attributions: z
    .array(
      z.object({
        provider: z.string().max(500).optional(),
        providerUri: z.url().optional(),
      }),
    )
    .default([]),
});
export async function searchPlaces(
  input: z.infer<typeof placesInput>,
  options: {
    key?: string;
    fetch?: typeof fetch;
    contactDetails?: boolean;
  } = {},
) {
  const v = placesInput.parse(input),
    key = options.key ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw Error("PLACES_NOT_CONFIGURED");
  const r = await (options.fetch || fetch)(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus,places.attributions" +
          ((options.contactDetails ??
          process.env.GOOGLE_PLACES_CONTACT_DETAILS === "true")
            ? ",places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.currentOpeningHours"
            : ""),
      },
      body: JSON.stringify({
        textQuery: v.query,
        pageSize: 20,
        locationBias: {
          circle: {
            center: { latitude: v.lat, longitude: v.lng },
            radius: v.radiusKm * 1000,
          },
        },
      }),
    },
  );
  if (!r.ok) throw Error("PLACES_UPSTREAM_FAILED");
  const body = z
    .object({ places: z.array(place).max(20).default([]) })
    .parse(await boundedJson(r));
  return {
    items: body.places
      .map((p) => ({
        ...p,
        distanceKm:
          Math.round(
            distanceKm(
              v.lat,
              v.lng,
              p.location.latitude,
              p.location.longitude,
            ) * 10,
          ) / 10,
      }))
      .filter((p) => p.distanceKm <= v.radiusKm),
    attribution: "Google Maps",
    note: "Search suggestions are not verified hardware merchants and do not indicate stock. No Places content is persisted or cached.",
  };
}
