'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Sparkles } from 'lucide-react';
import { processTemplateChat } from '@/actions/templateChat';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    config?: Partial<TemplateConfig>;
    timestamp: Date;
}

interface TemplateConfig {
    layout?: 'table' | 'card';
    columns?: Array<{
        field: string;
        label: string;
        align?: 'left' | 'center' | 'right';
        format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
        width?: string;
        style?: { color?: string; bold?: boolean };
    }>;
    header?: {
        title?: string;
        subtitle?: string;
        logo?: boolean;
    };
    footer?: {
        showDate?: boolean;
        customText?: string;
        pageNumbers?: boolean;
    };
    aggregation?: {
        showTotal?: boolean;
    };
    style?: {
        primaryColor?: string;
        fontSize?: number;
    };
}

interface TemplateChatProps {
    onConfigUpdate: (config: Partial<TemplateConfig>) => void;
    modelFields: Array<{ key: string; label: string; type: string }>;
    currentConfig: Partial<TemplateConfig>;
}

export function TemplateChat({ onConfigUpdate, modelFields, currentConfig }: TemplateChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: '1',
            role: 'assistant',
            content: '안녕하세요! 어떤 형태로 데이터를 출력하고 싶으신가요? 예: "테이블 형태로 만들어줘", "헤더에 제목 추가해줘"',
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const apiMessages = [
                ...messages.filter(m => m.id !== '1'), // Skip the initial welcome message from context
                userMessage
            ].map(m => ({
                id: m.id,
                role: m.role,
                content: m.content
            }));

            const response = await processTemplateChat(apiMessages, currentConfig, modelFields);

            if (response.success) {
                const assistantMessage: ChatMessage = {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: response.message,
                    config: response.config,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, assistantMessage]);
                if (assistantMessage.config) {
                    onConfigUpdate(assistantMessage.config);
                }
            } else {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'assistant',
                    content: response.message || '오류가 발생했습니다.',
                    timestamp: new Date()
                }]);
            }
        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: '서버와 통신하는 중 문제가 발생했습니다.',
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-full bg-sidebar rounded-xl overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-chart-5" />
                <span className="text-sm font-bold text-sidebar-foreground">AI 템플릿 어시스턴트</span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map(msg => (
                    <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${msg.role === 'user'
                                ? 'bg-primary text-primary-foreground rounded-br-md'
                                : 'bg-sidebar-accent text-sidebar-accent-foreground rounded-bl-md'
                                }`}
                        >
                            {msg.role === 'assistant' && (
                                <span className="text-chart-5 text-xs font-medium block mb-1">🤖 AI</span>
                            )}
                            {msg.content}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-sidebar-accent text-sidebar-accent-foreground px-4 py-2.5 rounded-2xl rounded-bl-md">
                            <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-sidebar-border">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="템플릿 수정 요청..."
                        className="flex-1 bg-sidebar-accent text-sidebar-foreground px-4 py-2.5 rounded-xl text-sm placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-xl transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}


