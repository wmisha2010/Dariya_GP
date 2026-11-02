'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

/**
 * PWA-обвязка: регистрация сервис-воркера + плавающая кнопка «Установить
 * приложение» (появляется, когда браузер сам разрешает установку — Chrome/
 * Edge на ПК и Android; на iPhone установки через beforeinstallprompt нет,
 * там работает «Поделиться → На экран „Домой“»).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'daria-pwa-dismissed'

export function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    // В разработке сервис-воркер вреден: дев-чанки не хэшируются контентом,
    // и закэшированный код «приклеивается» — правки не доходят до браузера.
    // Снимаем воркер и чистим кэши; регистрация — только в проде
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch(() => {})
      void caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {})
      return
    }

    // Регистрация сервис-воркера (без неё браузер не предложит установку)
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* установка не критична для работы */
    })

    // Уже установлено как приложение — кнопку не показываем
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) return

    const onPrompt = (event: Event) => {
      event.preventDefault()
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return
      setInstallEvent(event as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      setInstallEvent(null)
      setVisible(false)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') {
      setVisible(false)
      setInstallEvent(null)
    }
  }, [installEvent])

  const dismiss = useCallback(() => {
    window.localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }, [])

  if (!visible || !installEvent) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full border border-teal-400/30 bg-[#0b1220]/90 py-1 pl-4 pr-1 shadow-[0_0_24px_-6px_rgba(34,211,238,0.45)] backdrop-blur-md">
      <button
        onClick={() => void install()}
        className="flex items-center gap-2 py-1.5 text-xs font-medium text-teal-300 transition-colors hover:text-teal-200"
      >
        <Download className="size-3.5" />
        Установить приложение
      </button>
      <button
        onClick={dismiss}
        aria-label="Скрыть предложение установки"
        className="grid size-6 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
