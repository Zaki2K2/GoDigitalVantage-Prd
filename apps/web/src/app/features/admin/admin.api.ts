import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';

export type AdminRecord = Record<string, unknown> & { _id: string };
export interface AdminResult {
  data: AdminRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  get<T>(path: string, query: Record<string, string> = {}) {
    const params = new HttpParams({
      fromObject: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '')),
    });
    return this.http.get<T>(`/api/v1/admin/${path}`, { params });
  }
  write(path: string, body: object, method: 'post' | 'patch' | 'delete' = 'post') {
    return this.auth.withCsrf(() =>
      this.http.request<{ data: AdminRecord }>(method, `/api/v1/admin/${path}`, { body }),
    );
  }
}
