// TEMPORARY visual check of the roadmap map. Deleted straight after.
import { RouteMap } from "@/components/RouteMap";
export default function P() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <section className="card overflow-hidden p-1.5">
        <RouteMap
          depot={{ lat: 17.4401, lng: 78.3489 }}
          stops={[
            { id: "a", n: 1, lat: 17.4156, lng: 78.4347, done: true },
            { id: "b", n: 2, lat: 17.4849, lng: 78.3995, done: false },
            { id: "c", n: 3, lat: 17.4968, lng: 78.3614, done: false },
          ]}
        />
      </section>
    </div>
  );
}
