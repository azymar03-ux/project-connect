import ProfileClient from "./ProfileClient";
import { publicMetadata } from "../../../lib/public-metadata";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return publicMetadata("people", (await params).id);
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProfileClient params={params} />;
}
