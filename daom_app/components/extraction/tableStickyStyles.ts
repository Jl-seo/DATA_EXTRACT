type StickyTableSection = 'header' | 'body';
type StickyTableColumn = 'actions' | 'first-data';

interface StickyTableClassOptions {
    section: StickyTableSection;
    column: StickyTableColumn;
    isSelected: boolean;
}

interface StickyTableClasses {
    cellClassName: string;
    innerClassName: string;
}

const joinClasses = (...classes: Array<string | false>): string => {
    return classes.filter(Boolean).join(' ');
};

export const getStickyTableClasses = ({
    section,
    column,
    isSelected,
}: StickyTableClassOptions): StickyTableClasses => {
    const isHeader = section === 'header';
    const isActionColumn = column === 'actions';

    const cellClassName = joinClasses(
        'relative',
        isActionColumn ? 'sticky left-0' : 'sticky left-16',
        isHeader ? 'top-0 z-50 bg-muted' : 'z-20 bg-background',
        !isActionColumn && 'shadow-[6px_0_10px_-6px_rgba(15,23,42,0.18)] after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-border'
    );

    if (isHeader) {
        return {
            cellClassName,
            innerClassName: '',
        };
    }

    return {
        cellClassName,
        innerClassName: joinClasses(
            'relative z-[1] h-full w-full bg-background',
            'group-hover/row:bg-primary/5',
            isSelected && 'bg-primary/15 ring-1 ring-inset ring-primary/50'
        ),
    };
};
