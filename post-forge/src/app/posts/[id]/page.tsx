import { RunView } from "../../../components/run-view";

type PostPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;

  return (
    <main>
      <RunView postId={id} />
    </main>
  );
}
