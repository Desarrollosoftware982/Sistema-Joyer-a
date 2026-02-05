import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default function ResetPasswordRedirect({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = new URLSearchParams();

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (Array.isArray(value)) {
        value.forEach((v) => {
          if (v !== undefined) params.append(key, v);
        });
      } else if (value !== undefined) {
        params.set(key, value);
      }
    }
  }

  const qs = params.toString();
  const target = qs ? `/dashboard/reset-password?${qs}` : "/dashboard/reset-password";
  redirect(target);
}
