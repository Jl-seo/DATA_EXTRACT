import { ModelEditor } from "@/components/extraction/ModelEditor";

interface PageProps {
    params: {
        id: string;
    };
}

export default function ExtractionModelEditPage({ params }: PageProps) {
    const isNew = params.id === 'new';

    return (
        <div className="flex flex-col h-full bg-background p-8">
            <ModelEditor modelId={isNew ? undefined : params.id} />
        </div>
    );
}
