{{- define "zkwasm-automata.rpcServiceName" -}}
{{ include "zkwasm-automata.fullname" . }}-rpc
{{- end -}}

{{- define "zkwasm-automata.mongodbServiceName" -}}
{{ include "zkwasm-automata.fullname" . }}-mongodb
{{- end -}}

{{- define "zkwasm-automata.redisServiceName" -}}
{{ include "zkwasm-automata.fullname" . }}-redis
{{- end -}}

{{- define "zkwasm-automata.merkleServiceName" -}}
{{ include "zkwasm-automata.fullname" . }}-merkle
{{- end -}}

{{- define "zkwasm-automata.depositServiceName" -}}
{{ include "zkwasm-automata.fullname" . }}-deposit
{{- end -}}

{{- define "zkwasm-automata.settlementServiceName" -}}
{{ include "zkwasm-automata.fullname" . }}-settlement
{{- end -}}
