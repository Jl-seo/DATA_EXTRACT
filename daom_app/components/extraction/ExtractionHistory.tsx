'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useExtractionLogs } from '@/queries/extraction';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

export function ExtractionHistory() {
    const { data: logs, isLoading, refetch, isRefetching } = useExtractionLogs();

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold">최근 추출 기록</h2>
                <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
                    새로고침
                </Button>
            </div>

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>파일명</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead>모델</TableHead>
                            <TableHead>요청자</TableHead>
                            <TableHead>시간</TableHead>
                            <TableHead className="text-right">결과</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    <div className="flex justify-center"><Loader2 className="animate-spin" /></div>
                                </TableCell>
                            </TableRow>
                        ) : logs?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    기록이 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            logs?.map((log) => (
                                <TableRow key={log.id}>
                                    <TableCell className="font-medium">{log.filename}</TableCell>
                                    <TableCell>
                                        <Badge variant={
                                            log.status === 'success' ? 'default' :
                                                log.status === 'processing' ? 'secondary' : 'destructive'
                                        }>
                                            {log.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground font-mono">
                                        {log.model_id.substring(0, 8)}...
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {log.created_by.name}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {log.created_at ? format(new Date(log.created_at), 'yyyy-MM-dd HH:mm') : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {log.status === 'success' && (
                                            <Button variant="ghost" size="sm" asChild>
                                                <Link href={`/extraction/result/${log.id}`}>
                                                    <ExternalLink className="w-4 h-4" />
                                                </Link>
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
