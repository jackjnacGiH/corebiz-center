import { CK, prefetchList } from './cache';
import { productsApi, customersApi, customerBranchesApi, categoriesApi, warehousesApi } from './api';

/** Warm heavy data only when a user points at/focuses the relevant menu.
 * Daily Chat/Shipping work no longer downloads the entire catalogue and CRM. */
export function prefetchPage(path: string): void {
    if (['/inventory', '/ecommerce', '/orders', '/image-studio'].includes(path)) {
        prefetchList(CK.products, () => productsApi.list());
        prefetchList(CK.categories, () => categoriesApi.list());
        prefetchList(CK.warehouses, () => warehousesApi.list());
    }
    if (['/crm', '/orders'].includes(path)) prefetchList(CK.customers, () => customersApi.list());
    if (path === '/crm') prefetchList(CK.customerBranches, () => customerBranchesApi.listAll());
}
