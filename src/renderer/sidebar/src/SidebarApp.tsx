import React, { useEffect, useState } from 'react'
import { ChatProvider } from './contexts/ChatContext'
import { Chat } from './components/Chat'
import { useDarkMode } from '@common/hooks/useDarkMode'
import { AgentPanel } from './components/AgentPanel'
import { cn } from '@common/lib/utils'

const SidebarContent: React.FC = () => {
    const { isDarkMode } = useDarkMode()
    const [view, setView] = useState<'chat' | 'agent'>('chat')

    // Apply dark mode class to the document
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDarkMode])

    return (
        <div className="h-screen flex flex-col bg-background border-l border-border">
            <div className="border-b border-border/80 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="grid grid-cols-2">
                    <button
                        className={cn(
                            'py-3 text-sm font-medium transition-colors',
                            view === 'chat'
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                        onClick={() => setView('chat')}
                    >
                        Chat
                    </button>
                    <button
                        className={cn(
                            'py-3 text-sm font-medium transition-colors',
                            view === 'agent'
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                        onClick={() => setView('agent')}
                    >
                        Agent
                    </button>
                </div>
            </div>

            <div className="flex-1">
                {view === 'chat' ? <Chat /> : <AgentPanel />}
            </div>
        </div>
    )
}

export const SidebarApp: React.FC = () => {
    return (
        <ChatProvider>
            <SidebarContent />
        </ChatProvider>
    )
}

