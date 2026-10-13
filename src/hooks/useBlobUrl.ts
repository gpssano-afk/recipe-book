import { useEffect, useState } from 'react'

export function useBlobUrl(blob: Blob | undefined) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setValue({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return blob && value?.blob === blob ? value.url : undefined
}
