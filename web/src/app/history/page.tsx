"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function HistoryRedirectPage() {
  const router = useRouter()
  useEffect(() => { router.replace("/practice/history") }, [router])
  return null
}
