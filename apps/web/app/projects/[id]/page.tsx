import ProjectClient from "./ProjectClient";
import { publicMetadata } from "../../../lib/public-metadata";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return publicMetadata("projects", (await params).id);
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectClient params={params} />;
}
