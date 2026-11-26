import { CoSignWorkspace } from '@/components/CoSignWorkspace';

export const dynamic = 'force-dynamic';

export default async function SignTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CoSignWorkspace token={token} />;
}
