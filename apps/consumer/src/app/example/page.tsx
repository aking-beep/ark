import { redirect } from 'next/navigation';
import { encodeIntake } from '@/lib/encode';
import { EXAMPLE_INTAKE } from '@/lib/example-intake';

export default function Example() {
  const i = encodeIntake(EXAMPLE_INTAKE);
  redirect(`/result?i=${i}`);
}
