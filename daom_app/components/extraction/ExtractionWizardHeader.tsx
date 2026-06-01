'use client';

import { Check, ArrowLeft } from 'lucide-react';
import { WIZARD_STEPS } from './constants';
import type { ViewStep } from './types';
import { cn } from '@/lib/utils';

interface ExtractionWizardHeaderProps {
    activeStep: ViewStep;
    modelName: string;
    onStepChange: (step: ViewStep) => void;
    onCancel: () => void;
}

export function ExtractionWizardHeader({ activeStep, modelName, onStepChange, onCancel }: ExtractionWizardHeaderProps) {
    const currentStepIndex = WIZARD_STEPS.findIndex(s => s.id === activeStep);

    return (
        <div className="border-b bg-background">
            <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-semibold">{modelName}</h2>
                        <p className="text-sm text-muted-foreground">데이터 추출 마법사</p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
                    >
                        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                        뒤로가기
                    </button>
                </div>

                {/* Wizard Steps */}
                <div className="flex items-center gap-2">
                    {WIZARD_STEPS.map((step, index) => {
                        const isActive = step.id === activeStep;
                        const isCompleted = index < currentStepIndex;
                        const Icon = step.icon;

                        return (
                            <div key={step.id} className="flex items-center flex-1">
                                <button
                                    onClick={() => {
                                        // Allow navigation to completed steps
                                        if (isCompleted || isActive) {
                                            onStepChange(step.id);
                                        }
                                    }}
                                    disabled={!isCompleted && !isActive}
                                    className={cn(
                                        "flex items-center gap-3 px-4 py-3 rounded-lg transition-all flex-1",
                                        isActive && "bg-primary text-primary-foreground shadow-sm",
                                        isCompleted && !isActive && "bg-muted hover:bg-muted/80 cursor-pointer",
                                        !isCompleted && !isActive && "bg-muted/50 opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    <div className={cn(
                                        "flex items-center justify-center w-8 h-8 rounded-full",
                                        isActive && "bg-primary-foreground/20",
                                        isCompleted && !isActive && "bg-chart-2 text-chart-2-foreground"
                                    )}>
                                        {isCompleted ? (
                                            <Check className="w-4 h-4" />
                                        ) : (
                                            <Icon className="w-4 h-4" />
                                        )}
                                    </div>
                                    <div className="flex-1 text-left">
                                        <div className="font-medium text-sm">{step.label}</div>
                                        <div className={cn(
                                            "text-xs",
                                            isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                                        )}>
                                            {step.description}
                                        </div>
                                    </div>
                                </button>

                                {/* Connector Line */}
                                {index < WIZARD_STEPS.length - 1 && (
                                    <div className={cn(
                                        "h-0.5 w-8 mx-2",
                                        isCompleted ? "bg-chart-2" : "bg-muted"
                                    )} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
