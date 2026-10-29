import { useQueryClient } from "@tanstack/react-query";
export function useRefresh() {
  const cache = useQueryClient();
  return () => cache.invalidateQueries();
}
