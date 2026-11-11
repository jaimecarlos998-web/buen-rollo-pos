import openpyxl, collections, sys
wb=openpyxl.load_workbook(sys.argv[1],data_only=True)
inv=wb['Inventario']; rows=[r for r in inv.iter_rows(min_row=2,values_only=True) if r[0]]
c=collections.Counter(r[0] for r in rows); print('dup',[ (k,[r[1] for r in rows if r[0]==k]) for k,v in c.items() if v>1])
print('sin costo',sum(1 for r in rows if r[2] in (None,'')),'sin precio',sum(1 for r in rows if r[3] in (None,'')))
print('stock types',collections.Counter(type(r[7]).__name__ for r in rows))
print('neg', sum(1 for r in rows if isinstance(r[7],(int,float)) and r[7]<0))
skus=set(c)
rem=[r for r in wb['Remito'].iter_rows(min_row=2,values_only=True) if r[2]]
print('remito sku missing',[ (r[2],r[3]) for r in rem if r[2] not in skus][:20])
ven=[r for r in wb['Ventas'].iter_rows(min_row=2,values_only=True) if r[2]]
print('ventas sku missing',collections.Counter((r[2],r[3]) for r in ven if r[2] not in skus).most_common(20))
print('ventas sin nro',sum(1 for r in ven if not r[1]), 'fechas tipos',collections.Counter(type(r[0]).__name__ for r in ven))
print('pedidos',len(set(r[1] for r in ven)))
print('remito fechas',collections.Counter(type(r[1]).__name__ for r in rem), 'nros', collections.Counter((r[0],r[7]) for r in rem).most_common(20))
print('cant tipos', collections.Counter(type(r[4]).__name__ for r in ven), [r for r in ven if not isinstance(r[4],(int,float)) or r[4]<=0][:5])
print([r for r in ven if not isinstance(r[5],(int,float))][:5])
print('clientes', collections.Counter(r[8] for r in ven).most_common(8))
print('rem cant', [r for r in rem if not isinstance(r[4],(int,float)) or not isinstance(r[5],(int,float))][:5])
